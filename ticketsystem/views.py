from django.http import HttpResponse
from django.shortcuts import render, get_object_or_404

# Create your views here.
from .models import *


def index(request):
	return render(request, 'home/index.html')


def hall_index(request):
	halls = Hall.objects.all()
	return render(request, 'hall/index.html', {'halls': halls})


def get_hall(request, hall_id):
	hall = get_object_or_404(Hall, pk=hall_id)
	return render(request, 'hall/detail.html', {'hall': hall})

