from django.db import models
from django.contrib.postgres.fields import ArrayField
# Create your models here.


class Hall(models.Model):
	name = models.CharField(max_length=200)
	seats = models.JSONField()
	seatPlan = models.JSONField()

	def __str__(self):
		return self.name


class Event(models.Model):
	name = models.CharField(max_length=200)
	hall = models.ForeignKey(Hall, on_delete=models.CASCADE)

	def __str__(self):
		return self.name


class Day(models.Model):
	date = models.DateTimeField()
	event = models.ForeignKey(Event, on_delete=models.CASCADE)
	tickets_dict = models.JSONField()

	def __str__(self):
		return str(self.date)


class Ticket(models.Model):
	row = models.CharField(max_length=10)
	num = models.CharField(max_length=10)
	event = models.ForeignKey(Event, on_delete=models.CASCADE)
	day = models.ForeignKey(Day, on_delete=models.CASCADE)
	price = models.PositiveSmallIntegerField()
	status = models.PositiveSmallIntegerField(default=0)
	category = models.PositiveSmallIntegerField()
	lastModifiedBy = models.CharField(max_length=200)
	lastModified = models.DateTimeField(auto_now=True)

	def __str__(self):
		return f'{self.row}-{self.num}-{self.day.date}'

