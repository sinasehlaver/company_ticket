from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('hall/', views.hall_index, name='hall_index'),
    path('hall/<int:hall_id>/', views.get_hall, name='get_hall'),
]