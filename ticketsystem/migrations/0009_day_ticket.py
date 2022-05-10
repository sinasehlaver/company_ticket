# Generated by Django 4.0.1 on 2022-05-10 18:12

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('ticketsystem', '0008_delete_ticket'),
    ]

    operations = [
        migrations.CreateModel(
            name='Day',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateTimeField()),
                ('tickets_dict', models.JSONField()),
                ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='ticketsystem.event')),
            ],
        ),
        migrations.CreateModel(
            name='Ticket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('row', models.CharField(max_length=10)),
                ('num', models.CharField(max_length=10)),
                ('price', models.PositiveSmallIntegerField()),
                ('status', models.PositiveSmallIntegerField(default=0)),
                ('category', models.PositiveSmallIntegerField()),
                ('lastModifiedBy', models.CharField(max_length=200)),
                ('lastModified', models.DateTimeField(auto_now=True)),
                ('day', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='ticketsystem.day')),
                ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='ticketsystem.event')),
            ],
        ),
    ]
